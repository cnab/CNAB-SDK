// Test-only module. It consumes the binding that `jsii-pacmak --targets go`
// generates into packages/core/dist/go/cnabcore, via the replace directive
// below — there is no published module yet (that is #41 steps 2-3, ADR 0009),
// so the tests must point at the freshly generated output rather than at a
// version from a proxy. This is the Go analogue of `pip install dist/*.whl`.
module github.com/cnab/cnab-core-go-bindingtests

go 1.25.0

require github.com/cnab/cnab-core-go/cnabcore v0.0.0

require (
	github.com/Masterminds/semver/v3 v3.5.0 // indirect
	github.com/aws/jsii-runtime-go v1.139.0 // indirect
)

replace github.com/cnab/cnab-core-go/cnabcore => ../../packages/core/dist/go/cnabcore
