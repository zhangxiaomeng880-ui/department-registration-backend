const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const extractOutputText = payload => {
  const parts = [];
  for (const item of payload?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        parts.push(content.text);
      }
    }
  }
  return parts.join('\n').trim();
};

export const modelProviderConfigured = modelKey =>
  Boolean(process.env.OPENAI_API_KEY && (modelKey || process.env.OPENAI_MODEL));

export const classifyProviderError = error => {
  if (error?.name === 'AbortError') return 'TIMEOUT';
  const code = String(error?.code || '');
  if (code === 'MODEL_PROVIDER_NOT_CONFIGURED') return 'CONFIGURATION';
  if (code === 'MODEL_PROVIDER_INVALID_JSON' || code === 'MODEL_PROVIDER_EMPTY_OUTPUT') return 'PROVIDER_RESPONSE';
  if (code === 'MODEL_PROVIDER_HTTP_ERROR' || Number(error?.details?.providerStatus || 0) >= 400) return 'PROVIDER_HTTP';
  return 'PROVIDER_RUNTIME';
};

export const invokeOpenAiResponses = async ({
  instructions,
  input,
  schema,
  schemaName = 'agent_output',
  metadata = {},
  modelKey,
}) => {
  const resolvedModel = modelKey || process.env.OPENAI_MODEL || null;
  if (!modelProviderConfigured(resolvedModel)) {
    const error = new Error('OpenAI model provider is not configured');
    error.code = 'MODEL_PROVIDER_NOT_CONFIGURED';
    error.statusCode = 503;
    throw error;
  }

  const baseUrl = String(process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const controller = new AbortController();
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 120000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: resolvedModel,
        instructions,
        input,
        store: false,
        metadata,
        text: {
          format: {
            type: 'json_schema',
            name: schemaName,
            strict: true,
            schema,
          },
        },
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `OpenAI Responses request failed: ${response.status}`);
      error.code = payload?.error?.code || 'MODEL_PROVIDER_HTTP_ERROR';
      error.statusCode = 502;
      error.details = {
        providerStatus: response.status,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      };
      throw error;
    }

    const outputText = extractOutputText(payload);
    if (!outputText) {
      const error = new Error('Model provider returned no output_text');
      error.code = 'MODEL_PROVIDER_EMPTY_OUTPUT';
      error.statusCode = 502;
      throw error;
    }

    let output;
    try {
      output = JSON.parse(outputText);
    } catch {
      const error = new Error('Model provider output was not valid JSON');
      error.code = 'MODEL_PROVIDER_INVALID_JSON';
      error.statusCode = 502;
      throw error;
    }

    return {
      provider: 'openai-responses',
      providerResponseId: payload.id || null,
      model: payload.model || resolvedModel,
      status: payload.status || 'completed',
      serviceTier: payload.service_tier || null,
      output,
      usage: payload.usage || null,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  } catch (error) {
    error.errorCategory = error.errorCategory || classifyProviderError(error);
    error.durationMs = error.durationMs
      ?? error.details?.durationMs
      ?? Math.max(0, Math.round(performance.now() - startedAt));
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
