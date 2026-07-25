# Request Envelope

```text
Input:  CreateUserRequestInput
Output: UserRequestEnvelope
```

The builder normalizes and validates one incoming user request. It does not
classify intent, inspect repository contents, create a run, or log metadata.

Free-form metadata is intentionally excluded. Only typed correlation IDs may
cross this boundary.
