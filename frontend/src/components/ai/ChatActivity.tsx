import { useEffect, useState } from 'react';
import { Check, ChevronRight, Sparkles, CircleAlert } from 'lucide-react';
import type { ChatProgress } from '../../types/ai';
import ChatTaskPlan from './ChatTaskPlan';

function elapsedLabel(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function ChatActivity({
  progress,
  startedAt,
  duration,
  failed = false,
}: {
  progress: ChatProgress[];
  startedAt?: number;
  duration?: number | null;
  failed?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const running = startedAt !== undefined;
  const [expanded, setExpanded] = useState(running);
  const plan = [...progress].reverse().find((event) => event.plan)?.plan;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [running, startedAt]);
  const elapsed = running ? now - startedAt : (duration ?? progress.at(-1)?.elapsed_ms ?? 0);
  return (
    <div className={'ai-activity' + (running ? ' ai-activity-running' : '')}>
      <div className="ai-activity-heading">
        {running ? (
          <Sparkles size={15} className="ai-activity-pulse" />
        ) : failed || progress.at(-1)?.stage === 'warning' ? (
          <CircleAlert size={14} />
        ) : (
          <Check size={14} />
        )}
        <strong>{running ? 'Denkt nach' : 'Bearbeitung'}</strong>
        <span className="ai-activity-timer" role={running ? 'timer' : undefined} aria-live="off">
          {elapsedLabel(elapsed)}
        </span>
      </div>
      {running && (
        <p className="ai-activity-current" role="status">
          {progress.at(-1)?.summary || 'Antwort wird vorbereitet …'}
        </p>
      )}
      {!!progress.length && (
        <details
          className="ai-activity-details"
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
          <summary>
            <ChevronRight size={13} />
            {plan ? 'Aufgaben & Ergebnisse' : 'Arbeitsschritte'}{' '}
            <span>{plan ? plan.tasks.length : progress.length}</span>
          </summary>
          {plan ? (
            <ChatTaskPlan plan={plan} progress={progress} running={running} />
          ) : (
            <ol>
              {progress.map((step, index) => (
                <li key={index} className={'ai-activity-step ai-activity-' + step.stage}>
                  <span className="ai-activity-time">{elapsedLabel(step.elapsed_ms)}</span>
                  <span>{step.summary}</span>
                </li>
              ))}
            </ol>
          )}
        </details>
      )}
    </div>
  );
}
