package openapi

import _ "embed"

// JSON OpenAPI 3 文档（静态，发版一体包内嵌）。
//
//go:embed openapi.json
var JSON []byte
