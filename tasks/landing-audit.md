# Landing page audit and integration

Verdict: suitable for Cascade Zero after the corrections below. The supplied typography, dark teal palette, section structure and responsive layout are retained.

## Findings resolved

- Correctness: replaced the universal “every fix is safe alone” claim; the product scores heuristic joint risk rather than guaranteeing safety.
- Correctness: corrected the persistence description to local JSON records, and distinguished reproducible simulator inputs from potentially variable live model responses.
- Evidence: verified the primary 100-seed F1 holdout figures against `experiments/holdout-f1/report.md`. Independent agents: +35.2% failed users versus no intervention; coordinator: −45.0% versus independent agents, better on 94/100 seeds. Guardrails: 6.3% fewer failed users than the coordinator. Source report linked publicly.
- Evidence: the numerical hero illustration is visibly marked as an example, not live telemetry. Published holdout results are historical simulator evidence.
- Accessibility: fixed solid CTA foreground contrast and the missing mobile-menu ARIA target; Escape closes the menu and restores button focus. Motion reduction is respected.
- Security: only GET/HEAD `/` bypass operator authentication. Console pages, API routes and writes retain authentication and origin checks. The public page makes no backend requests.
- Integration: root renders the supplied landing page; all console CTAs lead to `/overview`; the console sidebar links back to the project home. Landing scrolling and console viewport containment are verified across navigation.
- Architecture/performance: three supplied landing components/styles added using existing Next/React dependencies; no additional runtime packages or third-party asset requests.

## Verification

Production build and lint; browser tests at 320, 768, 1024 and 1440 px; public/private authority checks; mobile menu and anchors; console round trip; no horizontal page overflow; screenshots captured after entrance animations settle. Existing operator workflows remain covered by the full browser suite.
