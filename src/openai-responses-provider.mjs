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

export const modelProviderConfigured = () =>
  Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);

export const invokeOpenAiResponses = async ({
  instructions,
  input,
  schema,
  schemaName = 'agent_output',
  metadata = {},
}) => {
  if (!modelProviderConfigured()) {
    const error = new Error('OpenAI model provider is not configured');
    error.code = 'MODEL_PROVIDER_NOT_CONFIGURED';
    error.statusCode = 503;
    throw error;
  }

  const baseUrl = String(process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const controller = new AbortController();
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 120000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL,
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
      error.details = { providerStatus: response.status };
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
      model: payload.model || process.env.OPENAI_MODEL,
      status: payload.status || 'completed',
      output,
      usage: payload.usage || null,
    };
  } finally {
    clearTimeout(timer);
  }
};
