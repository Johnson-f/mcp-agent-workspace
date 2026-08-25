import {
  evaluateAutomationActivationPreflight,
  evaluateAutomationRunStartPreflight,
  type AutomationActivationPreflightInput,
  type AutomationPreflightBlockerCode,
  type AutomationRunStartAction,
  type AutomationRunStartPreflightInput,
} from "./automation-activation";
import {
  evaluateRunBriefDraft,
  type RunBriefDraft,
} from "./conversation-run-brief";
import {
  projectRunHistoryVisibility,
  type RunHistoryVisibilityInput,
  type RunStepType,
} from "./run-history-visibility";

export type EvalTestLayer =
  | "golden_interview_scenarios"
  | "run_brief_schema_validation"
  | "forbidden_assumption_detection"
  | "tool_approval_policy"
  | "mcp_gateway_denials"
  | "mcp_gateway_idempotency"
  | "automation_activation_preflight"
  | "schedule_policy"
  | "bridge_failure_mapping"
  | "artifact_retention"
  | "run_history_visibility";

export const REQUIRED_V1_EVAL_LAYERS: EvalTestLayer[] = [
  "golden_interview_scenarios",
  "run_brief_schema_validation",
  "forbidden_assumption_detection",
  "tool_approval_policy",
  "mcp_gateway_denials",
  "mcp_gateway_idempotency",
  "automation_activation_preflight",
  "schedule_policy",
  "bridge_failure_mapping",
  "artifact_retention",
  "run_history_visibility",
];

export interface EvalRouteCoverageResult {
  ready: boolean;
  coveredLayers: EvalTestLayer[];
  missingLayers: EvalTestLayer[];
}

export interface ForbiddenAssumptionExpectation {
  name: string;
  relatedMissingFieldPath: string;
}

export interface GoldenAutomationScenarioExpected {
  canCreateRunBriefVersion: boolean;
  canApproveRunBriefVersion: boolean;
  missingRunBriefFieldPaths: string[];
  writeToolAcknowledgementIds: string[];
  forbiddenAssumptionsBlocked: ForbiddenAssumptionExpectation[];
  activationCanActivate?: boolean;
  activationBlockerCodes?: AutomationPreflightBlockerCode[];
  temporalScheduleId?: string | null;
  runStartAction?: AutomationRunStartAction;
  userVisibleRunStepTypes?: RunStepType[];
  adminAuditVisible?: boolean;
}

export interface GoldenAutomationScenario {
  id: string;
  title: string;
  userRequest: string;
  draft: RunBriefDraft;
  activation?: AutomationActivationPreflightInput;
  runStart?: AutomationRunStartPreflightInput;
  visibility?: RunHistoryVisibilityInput;
  expected: GoldenAutomationScenarioExpected;
}

export interface GoldenScenarioCheckResult {
  name: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
}

export interface GoldenScenarioEvaluationResult {
  scenarioId: string;
  passed: boolean;
  checks: GoldenScenarioCheckResult[];
}

const ordered = <T extends string>(values: T[]) => [...values].sort();

const addCheck = (
  checks: GoldenScenarioCheckResult[],
  name: string,
  expected: unknown,
  actual: unknown,
) => {
  checks.push({
    name,
    expected,
    actual,
    passed: JSON.stringify(expected) === JSON.stringify(actual),
  });
};

export const evaluateEvalRouteCoverage = (
  coveredLayers: EvalTestLayer[],
): EvalRouteCoverageResult => {
  const covered = new Set(coveredLayers);
  const missingLayers = REQUIRED_V1_EVAL_LAYERS.filter(
    (layer) => !covered.has(layer),
  );

  return {
    ready: missingLayers.length === 0,
    coveredLayers: REQUIRED_V1_EVAL_LAYERS.filter((layer) =>
      covered.has(layer),
    ),
    missingLayers,
  };
};

export const evaluateGoldenAutomationScenario = (
  scenario: GoldenAutomationScenario,
): GoldenScenarioEvaluationResult => {
  const checks: GoldenScenarioCheckResult[] = [];
  const briefEvaluation = evaluateRunBriefDraft(scenario.draft);

  addCheck(
    checks,
    "run brief can be created",
    scenario.expected.canCreateRunBriefVersion,
    briefEvaluation.canCreateRunBriefVersion,
  );
  addCheck(
    checks,
    "run brief can be approved",
    scenario.expected.canApproveRunBriefVersion,
    briefEvaluation.canApproveRunBriefVersion,
  );
  addCheck(
    checks,
    "missing run brief fields",
    ordered(scenario.expected.missingRunBriefFieldPaths),
    ordered(briefEvaluation.missingFields.map((field) => field.path)),
  );
  addCheck(
    checks,
    "write tool acknowledgements",
    ordered(scenario.expected.writeToolAcknowledgementIds),
    ordered(
      briefEvaluation.writeToolAcknowledgementsRequired.map(
        (requirement) => requirement.toolAuthorizationId,
      ),
    ),
  );

  for (const assumption of scenario.expected.forbiddenAssumptionsBlocked) {
    addCheck(
      checks,
      `forbidden assumption blocked: ${assumption.name}`,
      true,
      briefEvaluation.missingFields.some(
        (field) => field.path === assumption.relatedMissingFieldPath,
      ),
    );
  }

  if (scenario.activation) {
    const activation = evaluateAutomationActivationPreflight(
      scenario.activation,
    );
    addCheck(
      checks,
      "activation can activate",
      scenario.expected.activationCanActivate,
      activation.canActivate,
    );
    addCheck(
      checks,
      "activation blocker codes",
      ordered(scenario.expected.activationBlockerCodes ?? []),
      ordered(activation.blockers.map((blocker) => blocker.code)),
    );
    addCheck(
      checks,
      "temporal schedule id",
      scenario.expected.temporalScheduleId,
      activation.temporalScheduleIntent?.scheduleId ?? null,
    );
  }

  if (scenario.runStart) {
    const runStart = evaluateAutomationRunStartPreflight(scenario.runStart);
    addCheck(
      checks,
      "run start action",
      scenario.expected.runStartAction,
      runStart.action,
    );
  }

  if (scenario.visibility) {
    const visibility = projectRunHistoryVisibility(scenario.visibility);
    addCheck(
      checks,
      "user visible run step types",
      scenario.expected.userVisibleRunStepTypes ?? [],
      visibility.userRunHistory.steps.map((step) => step.type),
    );
    addCheck(
      checks,
      "admin audit visible",
      scenario.expected.adminAuditVisible ?? false,
      visibility.adminAuditLog !== null,
    );
  }

  return {
    scenarioId: scenario.id,
    passed: checks.every((check) => check.passed),
    checks,
  };
};
