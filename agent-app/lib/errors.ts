export type ErrorType =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limit"
  | "offline";

export type Surface =
  | "chat"
  | "auth"
  | "api"
  | "stream"
  | "database"
  | "history"
  | "vote"
  | "document"
  | "suggestions"
  | "activate_gateway";

export type ErrorCode = `${ErrorType}:${Surface}`;

export type ErrorVisibility = "response" | "log" | "none";

export const visibilityBySurface: Record<Surface, ErrorVisibility> = {
  activate_gateway: "response",
  api: "response",
  auth: "response",
  chat: "response",
  database: "log",
  document: "response",
  history: "response",
  stream: "response",
  suggestions: "response",
  vote: "response",
};

export class ChatbotError extends Error {
  type: ErrorType;
  surface: Surface;
  statusCode: number;

  constructor(errorCode: ErrorCode, cause?: string | ErrorOptions) {
    const message = getMessageByErrorCode(errorCode);
    const options = typeof cause === "string" ? undefined : cause;

    super(message, options);

    const [type, surface] = errorCode.split(":");

    this.type = type as ErrorType;
    if (typeof cause === "string") {
      this.cause = cause;
    }
    this.surface = surface as Surface;
    this.statusCode = getStatusCodeByType(this.type);
  }

  toResponse() {
    const code: ErrorCode = `${this.type}:${this.surface}`;
    const visibility = visibilityBySurface[this.surface];

    const { message, cause, statusCode } = this;

    if (visibility === "log") {
      console.error({
        cause,
        code,
        message,
      });

      return Response.json(
        { code: "", message: "Произошла ошибка. Повторите попытку позже." },
        { status: statusCode }
      );
    }

    return Response.json({ cause, code, message }, { status: statusCode });
  }
}

export function getMessageByErrorCode(errorCode: ErrorCode): string {
  if (errorCode.includes("database")) {
    return "Не удалось выполнить запрос к базе данных.";
  }

  switch (errorCode) {
    case "bad_request:api":
      return "Не удалось обработать запрос. Проверьте данные и повторите попытку.";

    case "bad_request:activate_gateway":
      return "Модель не подключена. Настройте нашу модель или активируйте Vercel AI Gateway.";

    case "unauthorized:auth":
      return "Войдите, чтобы продолжить.";
    case "forbidden:auth":
      return "У аккаунта нет доступа к этой функции.";

    case "rate_limit:chat":
      return "Достигнут лимит сообщений. Повторите через час.";
    case "not_found:chat":
      return "Чат не найден.";
    case "forbidden:chat":
      return "Этот чат принадлежит другому пользователю.";
    case "unauthorized:chat":
      return "Войдите, чтобы открыть чат.";
    case "offline:chat":
      return "Не удалось отправить сообщение. Проверьте соединение и повторите попытку.";

    case "not_found:document":
      return "Документ не найден.";
    case "forbidden:document":
      return "Документ принадлежит другому пользователю.";
    case "unauthorized:document":
      return "Войдите, чтобы открыть документ.";
    case "bad_request:document":
      return "Не удалось создать или обновить документ. Проверьте данные.";

    default:
      return "Произошла ошибка. Повторите попытку позже.";
  }
}

function getStatusCodeByType(type: ErrorType) {
  switch (type) {
    case "bad_request":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "rate_limit":
      return 429;
    case "offline":
      return 503;
    default:
      return 500;
  }
}
