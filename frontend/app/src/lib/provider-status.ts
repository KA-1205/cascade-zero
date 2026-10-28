export function providerFailureHelp(reason: string): string {
  const help: Record<string, string> = {
    no_client_configured: 'Set GEMINI_API_KEY on the Python backend and restart it.',
    'http_status:400': 'Check the configured model and its supported request settings.',
    'http_status:401': 'Check the backend API key; the provider rejected authentication.',
    'http_status:403': 'Check API key restrictions and permission to use this model.',
    'http_status:404': 'Check GEMINI_MODEL; this model is unavailable to the configured API.',
    'http_status:429': 'Check provider quota, billing and rate limits before retrying.',
    'http_status:500': 'The provider returned an internal error. Test the connection again.',
    'http_status:503': 'The provider is unavailable. Test the connection again.',
    timeout: 'The provider did not respond within the request timeout.',
    transport_error: 'Check backend internet access, DNS and proxy settings.',
    schema_validation_failure: 'The model response did not match the required decision schema.',
    malformed_body: 'The provider returned no usable model answer.',
    unparseable_json: 'The model answer could not be parsed as JSON.',
    response_truncated: 'The model response reached its output limit before completing.',
    response_too_large: 'The provider response exceeded the bounded response size.',
    non_finite_model_value: 'Runtime policy rejected a non-finite model value.',
    probe_outside_policy: 'Runtime policy rejected a probe for an unauthorized action.',
    unknown_diagnostic_service: 'Runtime policy rejected a diagnosis naming an unknown service.',
    probe_budget_exhausted: 'The model requested more probe rounds than the runtime policy permits.',
    stale_telemetry: 'The planner is holding until fresh telemetry is available.',
    response_blocked: 'The provider blocked this model response.',
  };
  return help[reason] ?? 'Use Project Admin → Test AI connection to inspect the current provider status.';
}
