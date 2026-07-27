package apperr

import "fmt"

type AppError struct {
	Code       string
	Message    string
	HTTPStatus int
}

func (e *AppError) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func New(status int, code, message string) *AppError {
	return &AppError{Code: code, Message: message, HTTPStatus: status}
}

func Validation(msg string) *AppError {
	return New(400, "VALIDATION_ERROR", msg)
}

func Unauthorized(msg string) *AppError {
	return New(401, "UNAUTHORIZED", msg)
}

func Forbidden(msg string) *AppError {
	return New(403, "FORBIDDEN", msg)
}

func NotFound(msg string) *AppError {
	return New(404, "NOT_FOUND", msg)
}

func Conflict(msg string) *AppError {
	return New(409, "CONFLICT", msg)
}

func RateLimited(msg string) *AppError {
	return New(429, "RATE_LIMITED", msg)
}

func Internal(msg string) *AppError {
	return New(500, "INTERNAL_ERROR", msg)
}

func As(err error) (*AppError, bool) {
	if err == nil {
		return nil, false
	}
	if e, ok := err.(*AppError); ok {
		return e, true
	}
	return nil, false
}
