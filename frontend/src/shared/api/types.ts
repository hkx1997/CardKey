/**
 * 传输层类型 — 与后端共享契约
 * 业务 features 应通过 client 方法拿领域对象，不必直接拼装信封。
 */
export type { ApiEnvelope } from "@/entities/types";
export { ApiError } from "@/entities/types";
