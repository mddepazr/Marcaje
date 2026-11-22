class AppError(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = 400,
        code: str = "ERROR_APLICACION",
        details: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.details = details


class BadRequestError(AppError):
    def __init__(self, message: str = "Parámetros inválidos en la solicitud.", details: dict | None = None) -> None:
        super().__init__(message=message, status_code=400, code="SOLICITUD_INVALIDA", details=details)


class NotFoundError(AppError):
    def __init__(self, message: str = "Recurso no encontrado.", details: dict | None = None) -> None:
        super().__init__(message=message, status_code=404, code="RECURSO_NO_ENCONTRADO", details=details)
