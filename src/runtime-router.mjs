export const ROUTER_VERSION = 'router-p86-v1';

export const routeRuntimeTask = input => {
  const query = String(input?.query || '');
  const taskType = String(input?.taskType || '').toUpperCase();
  const projectType = String(input?.projectType || '').toUpperCase();

  const isScriptContinuity =
    taskType === 'SCRIPT_CONTINUITY' ||
    /连续性冷读|连续性|冷读|SC\d{3}/i.test(query);

  if (projectType === 'AIGC_CONTENT' && isScriptContinuity) {
    return {
      matched: true,
      routeRuleKey: 'P86',
      routePriority: 86,
      agentKey: 'Script Agent',
      skillKey: 'script-storyboard',
      toolKey: 'ChatGPT Library',
      policyResult: 'ALLOW',
      routerVersion: ROUTER_VERSION,
      reason: 'AIGC screenplay continuity analysis routed to Script Agent with Library knowledge retrieval',
    };
  }

  return {
    matched: false,
    routeRuleKey: 'UNMATCHED',
    routePriority: null,
    agentKey: null,
    skillKey: null,
    toolKey: null,
    policyResult: 'BLOCK',
    routerVersion: ROUTER_VERSION,
    reason: 'No runtime route matched',
  };
};
