class AnalyzerError(Exception):
    code = "ANALYZER_ERROR"


class AuthenticationError(AnalyzerError):
    code = "INVALID_SIGNATURE"


class DownloadError(AnalyzerError):
    code = "DOWNLOAD_FAILED"


class UnsafeUrlError(DownloadError):
    code = "UNSAFE_URL"


class InvalidPdfError(AnalyzerError):
    code = "INVALID_PDF"


class CallbackError(AnalyzerError):
    code = "CALLBACK_FAILED"


class JobCancelled(AnalyzerError):
    code = "JOB_CANCELLED"
