# Third-party software

The service does not copy third-party source code into this repository. Runtime
dependencies are installed from their official distributions. Verify all
licenses with legal counsel before commercial distribution.

| Component                       | Purpose                                      | License                   |
| ------------------------------- | -------------------------------------------- | ------------------------- |
| FastAPI                         | HTTP API                                     | MIT                       |
| Pydantic / pydantic-settings    | Contracts and configuration                  | MIT                       |
| qpdf                            | PDF structural validation                    | Apache-2.0                |
| pikepdf                         | PDF object inspection                        | MPL-2.0                   |
| PDFium / pypdfium2              | Independent parsing and rendering validation | BSD-3-Clause / Apache-2.0 |
| fontTools                       | Embedded font validation                     | MIT                       |
| LittleCMS (via Pillow ImageCms) | ICC profile validation                       | MIT                       |
| Pillow                          | Image and ICC bindings                       | HPND                      |
| Celery                          | Asynchronous worker                          | BSD-3-Clause              |
| Valkey                          | Queue transport/cache runtime                | BSD-3-Clause              |
| redis-py                        | Valkey protocol client                       | MIT                       |
| HTTPX                           | HTTP downloads and callbacks                 | BSD-3-Clause              |
| Uvicorn                         | ASGI server                                  | BSD-3-Clause              |
| pytest                          | Tests                                        | MIT                       |

The deployed container also includes Debian system packages and their
transitive libraries. Generate a software bill of materials (SBOM) and run a
container vulnerability scan as part of the release pipeline.
