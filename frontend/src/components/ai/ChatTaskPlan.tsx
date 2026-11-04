import { Check, Circle, CircleAlert, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { ChatProgress } from '../../types/ai';
import ChatTaskStep from './ChatTaskStep';

const effortNames: Record<string, string> = {
  none: 'Ohne',
  minimal: 'Minimal',
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
  xhigh: 'Sehr hoch',
  max: 'Maximal',
};
export default function ChatTaskPlan({
  plan,
  progress,
  running,
}: {
  plan: NonNullable<ChatProgress['plan']>;
  progress: ChatProgress[];
  running: boolean;
}) {
  const planned = progress.find((event) => event.plan);
  const finishing = progress.filter(
    (event) =>
      !event.taskId && ['synthesis', 'review', 'retry', 'complete', 'warning'].includes(event.stage)
  );
  const latest = finishing.at(-1);
  const complete = latest?.stage === 'complete';
  const working = running && !!finishing.length;
  return (
    <div className="ai-task-plan">
      <p className="ai-task-objective">{plan.objective}</p>
      <div className="ai-task-policy">
        Reasoning: {effortNames[plan.effort] || plan.effort} · {plan.tasks.length || 'Keine'}{' '}
        Teilaufgaben · maximal {plan.maxRepairs} Nachbesserungen je Aufgabe ·{' '}
        {Math.ceil(plan.maxSeconds / 60)} Minuten Zeitrahmen
      </div>
      {!!plan.scope.length && (
        <details className="ai-task-scope">
          <summary>Festgelegter Umfang</summary>
          <ul>
            {plan.scope.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </details>
      )}
      <ol className="ai-task-list">
        <li className="ai-task-row accepted">
          <Check size={15} />
          <div>
            <strong>Auftrag analysiert und begrenzt</strong>
            <p>{planned?.summary}</p>
          </div>
        </li>
        {plan.tasks.map((task) => (
          <ChatTaskStep
            key={task.id}
            task={task}
            events={progress.filter((event) => event.taskId === task.id)}
            running={running}
          />
        ))}
        <li
          className={
            'ai-task-row ' +
            (complete ? 'accepted' : working ? 'running' : latest ? 'blocked' : 'pending')
          }
        >
          {complete ? (
            <ShieldCheck size={15} />
          ) : working ? (
            <LoaderCircle size={15} className="ai-task-spinner" />
          ) : latest ? (
            <CircleAlert size={15} />
          ) : (
            <Circle size={15} />
          )}
          <div>
            <strong>Antwort zusammenführen und abschließen</strong>
            {latest && <p>{latest.summary}</p>}
            {finishing.some((event) => event.reason || event.details?.length) && (
              <details className="ai-task-notes">
                <summary>Ergebnis der Abschlussprüfung</summary>
                {finishing
                  .filter((event) => event.reason || event.details?.length)
                  .map((event, index) => (
                    <div key={index}>
                      {event.reason && <p>{event.reason}</p>}
                      {event.details?.map((item, itemIndex) => (
                        <p key={itemIndex}>{item}</p>
                      ))}
                    </div>
                  ))}
              </details>
            )}
          </div>
        </li>
      </ol>
    </div>
  );
}
