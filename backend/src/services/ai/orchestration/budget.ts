import type { BudgetPolicy } from './types.js';

export class BudgetEnded extends Error {}
export class RunCancelled extends Error {}

export function budgetFor(effort: string): BudgetPolicy {
  const rows: Record<string, Omit<BudgetPolicy, 'effort'>> = {
    none: {
      maxTasks: 1,
      maxTools: 18,
      maxModels: 14,
      taskRounds: 8,
      taskRepairs: 0,
      synthesisRepairs: 0,
      durationMs: 180000,
    },
    low: {
      maxTasks: 2,
      maxTools: 32,
      maxModels: 26,
      taskRounds: 12,
      taskRepairs: 1,
      synthesisRepairs: 1,
      durationMs: 300000,
    },
    medium: {
      maxTasks: 3,
      maxTools: 56,
      maxModels: 44,
      taskRounds: 18,
      taskRepairs: 1,
      synthesisRepairs: 1,
      durationMs: 600000,
    },
    high: {
      maxTasks: 4,
      maxTools: 80,
      maxModels: 64,
      taskRounds: 22,
      taskRepairs: 2,
      synthesisRepairs: 1,
      durationMs: 900000,
    },
    xhigh: {
      maxTasks: 5,
      maxTools: 100,
      maxModels: 80,
      taskRounds: 28,
      taskRepairs: 2,
      synthesisRepairs: 1,
      durationMs: 1200000,
    },
    max: {
      maxTasks: 6,
      maxTools: 128,
      maxModels: 100,
      taskRounds: 32,
      taskRepairs: 2,
      synthesisRepairs: 1,
      durationMs: 1500000,
    },
  };
  return Object.freeze({
    effort,
    ...(rows[effort === 'minimal' ? 'none' : effort] || rows.medium),
  });
}

export class RunBudget {
  readonly startedAt = Date.now();
  readonly deadline: number;
  readonly usage = { models: 0, tools: 0, cacheHits: 0 };
  constructor(
    readonly policy: BudgetPolicy,
    readonly signal?: AbortSignal
  ) {
    this.deadline = this.startedAt + policy.durationMs;
  }
  assertActive() {
    if (this.signal?.aborted) throw new RunCancelled('Bearbeitung vom Nutzer abgebrochen.');
    if (Date.now() >= this.deadline)
      throw new BudgetEnded('Der zu Beginn festgelegte Zeitrahmen ist erreicht.');
  }
  model() {
    this.assertActive();
    if (this.usage.models >= this.policy.maxModels)
      throw new BudgetEnded('Das geplante Budget für Modellaufrufe ist erreicht.');
    this.usage.models++;
  }
  tool() {
    this.assertActive();
    if (this.usage.tools >= this.policy.maxTools)
      throw new BudgetEnded('Das geplante Budget für Datenabfragen ist erreicht.');
    this.usage.tools++;
  }
  hasRoom(models = 1) {
    return (
      !this.signal?.aborted &&
      Date.now() < this.deadline - 5000 &&
      this.usage.models + models <= this.policy.maxModels
    );
  }
  canResearch(reservedModels = 4) {
    return (
      this.hasRoom(reservedModels + 1) &&
      Date.now() < this.deadline - 75000 &&
      this.usage.tools < this.policy.maxTools
    );
  }
}
