import "./landing.css";
import { LandingNav } from "./LandingNav";

const GITHUB = "https://github.com/KA-1205/cascade-zero";

const steps = [
  ["Generate an incident", "Pick a scenario (database slowdown, payments degradation, traffic surge, or noisy telemetry) and a seed. The simulator replays the same traffic and faults for the same seed; live model responses can vary."],
  ["Collect proposals", "Retry, scale and restart agents each propose an action based on what they see."],
  ["Check the combination", "The risk engine scores every subset, including pairwise interaction terms. The coordinator keeps the largest set under the limit and writes a reason for each exclusion."],
  ["Replay, then approve", "Replay the plan against a no-action baseline in the Experiment Lab. An operator approves or rejects, and the decision is recorded in the audit trail."],
];

const features = [
  ["Combination-aware risk", "Actions are scored as sets. Retries plus extra replicas on a shared database pool are flagged even when each is fine alone."],
  ["Blocks come with reasons", "Every excluded action carries a plain-language explanation, so an operator can disagree with it."],
  ["Human approval gate", "Operator-review runs hold recommendations for approval. Approving records a local replay only."],
  ["Reproducible simulator", "Four scenarios share a deterministic simulator. Trace hashes identify recorded runs; live AI decisions can vary."],
  ["Evaluate API", "POST /v1/evaluate answers the same question for any external agent: are these proposals safe together?"],
  ["AI planner with a deterministic gate", "A Gemini planner can add a diagnosis. Its picks pass through the same gate, and failures fall back to rules with a labeled reason."],
];

export function Landing() {
  return (
    <div className="lp" id="top">
      <a className="lp-skip" href="#main">Skip to content</a>
      <LandingNav />
      <main id="main">
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <h1>A safe fix can become a risky combination.</h1>
            <p className="lp-lede">
              When a system breaks, several recovery agents act at once and can pile onto the same database.
              Cascade Zero scores the combination, blocks the risky pair with a reason, and holds the plan for a human.
            </p>
            <div className="lp-actions">
              <a className="lp-btn lp-btn-solid" href="/overview">Open the console</a>
              <a className="lp-btn lp-btn-ghost" href={GITHUB} rel="noopener noreferrer">View on GitHub</a>
            </div>
            <p className="lp-note">Runs on a simulator. Nothing here touches a live system. The console asks for operator sign-in.</p>
          </div>

          <figure className="lp-card" aria-label="Example output of the evaluate endpoint">
            <figcaption>Illustrative safety check &middot; not live telemetry</figcaption>
            <div className="lp-row lp-ok">
              <span className="lp-tag">Allowed</span>
              <code>add_replicas</code>
              <span>scale-agent</span>
            </div>
            <div className="lp-row lp-block">
              <span className="lp-tag">Blocked</span>
              <code>increase_retries</code>
              <span>retry-agent</span>
            </div>
            <p className="lp-reason">
              In this example, combined risk 0.54 is over the 0.50 limit. The pair contends for the same database connection slots.
            </p>
            <div className="lp-meter" role="img" aria-label="Risk 0.54 against a limit of 0.50">
              <div className="lp-meter-fill" style={{ width: "54%" }} />
              <div className="lp-meter-limit" style={{ left: "50%" }} />
            </div>
          </figure>
        </section>

        <section id="problem" className="lp-section lp-split">
          <h2>Automation fixes one thing at a time. Outages don&rsquo;t.</h2>
          <div>
            <p>
              Runbooks and agents usually validate their own action. During an incident, a retry bot multiplies traffic,
              a scaler adds servers that each grab database connections, and a restarter removes capacity mid-spike.
              Each step looks reasonable. Together they can make the outage worse.
            </p>
            <p>
              Cascade Zero adds the missing check: it judges the set of actions, explains what it excluded, and leaves the
              final call to an operator.
            </p>
          </div>
        </section>

        <section className="lp-section lp-features" aria-labelledby="f-h">
          <h2 id="f-h">What is built</h2>
          <dl>
            {features.map(([t, d]) => (
              <div key={t}>
                <dt>{t}</dt>
                <dd>{d}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="how" className="lp-section">
          <h2>How it works</h2>
          <ol className="lp-steps">
            {steps.map(([t, d], i) => (
              <li key={t}>
                <span className="lp-step-n" aria-hidden="true">{i + 1}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="evidence" className="lp-section lp-evidence">
          <h2>What the experiments show, and what they don&rsquo;t</h2>
          <p className="lp-sub">
            From the repository&rsquo;s held-out experiment (100 seeds, simulated, not production data).
            See <a href={`${GITHUB}/blob/features/experiments/holdout-f1/report.md`}>the full holdout report</a>.
          </p>
          <ul>
            <li><strong>+35%</strong> failed users when three independent agents act, compared with doing nothing.</li>
            <li><strong>&minus;45%</strong> failed users with coordination, compared with independent agents. Better on 94 of 100 seeds.</li>
            <li><strong>Interaction terms matter.</strong> Without pairwise terms, mean failed users rose from 1,517 to 2,673 in this experiment.</li>
          </ul>
          <p className="lp-honest">
            A simple guardrail baseline did better than the coordinator by about 6.3% on failed users, and no policy
            reached sustained recovery in the test horizon. We publish that in the repo rather than hide it.
          </p>
        </section>

        <section id="scope" className="lp-section lp-split">
          <h2>Scope and limits</h2>
          <ul className="lp-plain">
            <li>Simulation only. No production infrastructure is changed. Optional AI requests contact Google’s model API.</li>
            <li>Risk weights are hand-set heuristics, not calibrated on real incident data.</li>
            <li>Runs and approval receipts persist as local JSON records; there is no distributed database.</li>
            <li>Operator sign-in uses one shared account.</li>
          </ul>
        </section>

        <section className="lp-cta">
          <h2>See a plan get blocked, then decide for yourself.</h2>
          <div className="lp-actions">
            <a className="lp-btn lp-btn-light" href="/overview">Open the console</a>
            <a className="lp-btn lp-btn-outline" href={GITHUB} rel="noopener noreferrer">Read the code</a>
          </div>
        </section>
      </main>
      <footer className="lp-footer">
        <span>Cascade Zero &middot; built for REFORGED&rsquo;26</span>
        <span>Simulation only. Not for use on production systems.</span>
        <a href={GITHUB} rel="noopener noreferrer">GitHub</a>
      </footer>
    </div>
  );
}
