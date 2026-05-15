# object_storage (stub)

Implement **S3**, **GCS + S3 interoperability**, or **Azure Blob** with presigned PUT compatible with `@aws-sdk/client-s3` when pointed via `S3_ENDPOINT`.

Expose bucket name and IAM/access keys to the API as env vars (`S3_BUCKET`, `S3_REGION`, optional `S3_ENDPOINT`, credentials via secret store).
