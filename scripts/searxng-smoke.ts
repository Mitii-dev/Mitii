import { createOptionalSearchPort } from '../packages/host/src/ports/search.ts';
import {
  needsLiveWebEvidence,
  isExplicitWebSearchAsk,
} from '../packages/v8/src/modules/decision-policy/actions/BuildToolGrant.ts';
import { DecisionPolicyPipeline } from '../packages/v8/src/modules/decision-policy/pipeline/DecisionPolicyPipeline.ts';
import {
  createDecisionInput,
  createUnderstanding,
} from '../packages/v8/src/modules/decision-policy/tests/fixtures/decisionFixtureHelpers.ts';

const msg = 'Need Zebra ZP450 software compatible with Windows 11';
console.log({
  heuristic: needsLiveWebEvidence(msg, 'question'),
  explicit: isExplicitWebSearchAsk(msg, 'question'),
});

const decision = new DecisionPolicyPipeline().decide({
  ...createDecisionInput({
    mode: 'ask',
    message: msg,
    understanding: createUnderstanding({
      primaryTaskIntent: 'question',
      interactionIntent: 'question',
      taskAnalysis: {
        scope: 'unknown',
        recommendsRepositoryDiscovery: false,
      },
    }),
    hostCapabilities: { webSearch: true },
  }),
});
console.log({ tools: decision.toolGrant.allowedTools });

const search = createOptionalSearchPort({
  env: {},
  config: { searxngBaseUrl: 'http://192.168.0.91:8888' },
});
if (!search) throw new Error('SearchPort missing');
const result = await search.search({
  query: 'Zebra ZP450 Windows 11 software',
  maxResults: 3,
});
console.log({
  hits: result.results.length,
  urls: result.results.map((r) => r.url),
});
