# Security Review Checklist

Use during the security axis of `code-review-and-quality`.

## AuthN / AuthZ
- [ ] Authentication required where expected
- [ ] Authorization checked on every sensitive operation (not only UI)
- [ ] No privilege escalation via IDOR / missing ownership checks
- [ ] Session/token handling follows project standards

## Input / Output
- [ ] Untrusted input validated at trust boundaries
- [ ] Output encoded appropriately (HTML/SQL/shell/path)
- [ ] File path operations cannot escape intended roots
- [ ] Uploads constrained by type/size and stored safely

## Secrets & Data
- [ ] No secrets in source, logs, client bundles, or tests
- [ ] PII minimized; logging redacts sensitive fields
- [ ] Crypto uses vetted libraries; no home-rolled ciphers

## Dependencies & Supply Chain
- [ ] New dependencies justified and maintained
- [ ] Dangerous sinks reviewed (eval, child_process, dynamic SQL)

## Common Vulns
- [ ] Injection (SQL/NoSQL/command/template)
- [ ] XSS / CSRF where relevant
- [ ] SSRF / open redirects
- [ ] Insecure deserialization
