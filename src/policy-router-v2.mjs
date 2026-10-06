import { listRoutingCandidates } from './provider-registry.mjs';

export const POLICY_ROUTER_VERSION = 'policy-router-v2';

const POLICY_MODES = new Set([
  'LEGACY_SINGLE_PROVIDER',
  'QUALITY_FIRST',
  'COST_FIRST',
  'LATENCY_FIRST',
  'FALLBACK_ONLY',
]);

const qualityRank = { BASIC:1, STANDARD:2, HIGH:3, PREMIUM:4 };
const latencyRank = { FAST:1, BALANCED:2, SLOW:3 };
const costRank = { LOW:1, MEDIUM:2, HIGH:3 };
const healthRank = { HEALTHY:0, DEGRADED:1, UNKNOWN:2, DOWN:3 };

const normalize = value => String(value || '').toUpperCase();

const supportsTask = (candidate, taskType) => {
  const taskTypes = candidate.capabilities?.taskTypes;
  if (!Array.isArray(taskTypes) || !taskTypes.length) return true;
  return taskTypes.map(normalize).includes(normalize(taskType));
};

const supportsStructured = candidate =>
  candidate.supportsStructuredOutput === true &&
  candidate.capabilities?.structuredOutput !== false;

const compareLex = (a,b) =>
  String(a.providerKey).localeCompare(String(b.providerKey)) ||
  String(a.modelKey).localeCompare(String(b.modelKey));

const baseCompare = (a,b) =>
  (healthRank[a.healthStatus] ?? 99) - (healthRank[b.healthStatus] ?? 99) ||
  a.providerPriority - b.providerPriority ||
  a.modelPriority - b.modelPriority ||
  compareLex(a,b);

const comparatorFor = mode => {
  if (mode === 'QUALITY_FIRST') {
    return (a,b) =>
      (healthRank[a.healthStatus] ?? 99) - (healthRank[b.healthStatus] ?? 99) ||
      (qualityRank[b.qualityTier] ?? 0) - (qualityRank[a.qualityTier] ?? 0) ||
      (costRank[a.costTier] ?? 99) - (costRank[b.costTier] ?? 99) ||
      (latencyRank[a.latencyTier] ?? 99) - (latencyRank[b.latencyTier] ?? 99) ||
      a.providerPriority - b.providerPriority ||
      a.modelPriority - b.modelPriority ||
      compareLex(a,b);
  }
  if (mode === 'COST_FIRST') {
    return (a,b) =>
      (healthRank[a.healthStatus] ?? 99) - (healthRank[b.healthStatus] ?? 99) ||
      (costRank[a.costTier] ?? 99) - (costRank[b.costTier] ?? 99) ||
      (qualityRank[b.qualityTier] ?? 0) - (qualityRank[a.qualityTier] ?? 0) ||
      (latencyRank[a.latencyTier] ?? 99) - (latencyRank[b.latencyTier] ?? 99) ||
      a.providerPriority - b.providerPriority ||
      a.modelPriority - b.modelPriority ||
      compareLex(a,b);
  }
  if (mode === 'LATENCY_FIRST') {
    return (a,b) =>
      (healthRank[a.healthStatus] ?? 99) - (healthRank[b.healthStatus] ?? 99) ||
      (latencyRank[a.latencyTier] ?? 99) - (latencyRank[b.latencyTier] ?? 99) ||
      (qualityRank[b.qualityTier] ?? 0) - (qualityRank[a.qualityTier] ?? 0) ||
      (costRank[a.costTier] ?? 99) - (costRank[b.costTier] ?? 99) ||
      a.providerPriority - b.providerPriority ||
      a.modelPriority - b.modelPriority ||
      compareLex(a,b);
  }
  return baseCompare;
};

const candidateView = candidate => ({
  providerKey: candidate.providerKey,
  modelKey: candidate.modelKey,
  adapterKey: candidate.adapterKey,
  healthStatus: candidate.healthStatus,
  qualityTier: candidate.qualityTier,
  latencyTier: candidate.latencyTier,
  costTier: candidate.costTier,
});

const explicitFallbackOrder = (candidates, providerKeys) => {
  const byProvider = new Map();
  for (const candidate of candidates) {
    if (!byProvider.has(candidate.providerKey)) byProvider.set(candidate.providerKey, []);
    byProvider.get(candidate.providerKey).push(candidate);
  }
  const ordered = [];
  for (const providerKey of providerKeys) {
    const rows = [...(byProvider.get(providerKey) || [])].sort(baseCompare);
    ordered.push(...rows);
  }
  return ordered;
};

export const selectProviderModel = async input => {
  const mode = normalize(input?.policyMode || 'LEGACY_SINGLE_PROVIDER');
  if (!POLICY_MODES.has(mode)) {
    return {
      allowed:false,
      policyMode:mode,
      code:'UNSUPPORTED_POLICY_MODE',
      reason:'Unsupported provider routing policy mode',
      routerVersion:POLICY_ROUTER_VERSION,
      fallbackChain:[],
    };
  }

  if (mode === 'LEGACY_SINGLE_PROVIDER') {
    const modelKey = input?.modelKey || process.env.OPENAI_MODEL || null;
    return {
      allowed:true,
      policyMode:mode,
      code:'LEGACY_COMPATIBILITY',
      reason:'Legacy single-provider behavior preserved',
      routerVersion:POLICY_ROUTER_VERSION,
      selectedProviderKey:modelKey ? 'openai-responses' : null,
      selectedModelKey:modelKey,
      selectedAdapterKey:modelKey ? 'openai-responses' : null,
      providerHealthStatus:modelKey ? 'UNKNOWN' : null,
      fallbackChain:[],
      selectionSource:modelKey ? 'ENV_COMPATIBILITY' : 'UNRESOLVED_COMPATIBILITY',
    };
  }

  const taskType = normalize(input?.taskType);
  const requiredStructuredOutput = input?.requiredStructuredOutput === true;
  const allowedProviders = Array.isArray(input?.allowedProviderKeys)
    ? new Set(input.allowedProviderKeys)
    : null;
  const allowedModelPairs = Array.isArray(input?.allowedModelPairs)
    ? new Set(input.allowedModelPairs.map(item => `${item.providerKey}::${item.modelKey}`))
    : null;

  let candidates = (await listRoutingCandidates()).filter(candidate => {
    if (!candidate.providerEnabled || !candidate.modelEnabled) return false;
    if (candidate.healthStatus === 'DOWN' || candidate.healthStatus === 'UNKNOWN') return false;
    if (allowedProviders && !allowedProviders.has(candidate.providerKey)) return false;
    if (allowedModelPairs && !allowedModelPairs.has(`${candidate.providerKey}::${candidate.modelKey}`)) return false;
    if (!supportsTask(candidate, taskType)) return false;
    if (requiredStructuredOutput && !supportsStructured(candidate)) return false;
    return true;
  });

  if (input?.preferredModelKey) {
    const preferred = candidates.filter(c => c.modelKey === input.preferredModelKey);
    const others = candidates.filter(c => c.modelKey !== input.preferredModelKey);
    candidates = [...preferred, ...others];
  }

  if (mode === 'FALLBACK_ONLY') {
    const order = [];
    if (input?.preferredProviderKey) order.push(input.preferredProviderKey);
    for (const providerKey of input?.fallbackProviderKeys || []) {
      if (!order.includes(providerKey)) order.push(providerKey);
    }
    if (!order.length) {
      return {
        allowed:false,
        policyMode:mode,
        code:'FALLBACK_ORDER_REQUIRED',
        reason:'FALLBACK_ONLY requires preferredProviderKey or fallbackProviderKeys',
        routerVersion:POLICY_ROUTER_VERSION,
        fallbackChain:[],
      };
    }
    candidates = explicitFallbackOrder(candidates, order);
  } else {
    candidates = [...candidates].sort(comparatorFor(mode));
  }

  if (!candidates.length) {
    return {
      allowed:false,
      policyMode:mode,
      code:'NO_ALLOWED_PROVIDER_ROUTE',
      reason:'No enabled and healthy provider/model satisfies the policy inputs',
      routerVersion:POLICY_ROUTER_VERSION,
      fallbackChain:[],
    };
  }

  const selected = candidates[0];
  const fallbackChain = candidates.slice(1).map((candidate,index) => ({
    order:index + 1,
    ...candidateView(candidate),
  }));

  return {
    allowed:true,
    policyMode:mode,
    code:'PROVIDER_ROUTE_SELECTED',
    reason:'Provider/model selected deterministically from registry and policy inputs',
    routerVersion:POLICY_ROUTER_VERSION,
    selectedProviderKey:selected.providerKey,
    selectedModelKey:selected.modelKey,
    selectedAdapterKey:selected.adapterKey,
    providerHealthStatus:selected.healthStatus,
    fallbackChain,
    selected:candidateView(selected),
  };
};
