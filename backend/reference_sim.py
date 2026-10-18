"""Illustrative deterministic starter; NOT a validated performance benchmark."""
import argparse, json, random

def run(seed, policy, ticks=60):
    rng = random.Random(seed)
    queue = 0.0
    rows = []
    for t in range(ticks):
        demand = 55 + rng.randint(-5,5)
        capacity = 34 if 10 <= t < 35 else 72
        # Retry load is intentionally simplified; scale/restart effects are NOT modeled yet.
        retries = 0 if policy == 'none' else (0.35 if policy == 'independent' else 0.08)
        attempts = demand * (1+retries) + queue * 0.10
        processed = min(attempts, capacity)
        queue = max(0.0, queue + attempts - processed)
        rows.append({'tick':t,'attempts':round(attempts,2),'processed_attempts':round(processed,2),'queue':round(queue,2),'simulated':True})
    return {'seed':seed,'policy':policy,'model':'toy_retry_only','warning':'Not transaction-level outcomes or joint-action validation','trace':rows}

if __name__ == '__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--seed',type=int,default=42);ap.add_argument('--policy',choices=['none','independent','coordinated','all'],default='all');args=ap.parse_args()
    for policy in (['none','independent','coordinated'] if args.policy=='all' else [args.policy]):
        r=run(args.seed,policy);print(json.dumps({'seed':r['seed'],'policy':policy,'last_tick':r['trace'][-1],'warning':r['warning']}))
