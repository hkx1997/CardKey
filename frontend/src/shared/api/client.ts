import { env } from "@/shared/config/env";
import { httpClient } from "./http/client";
import { mockClient } from "./mock/client";

/** 统一 API 门面：features 只依赖此模块，不感知 mock/http */
export const api = env.isMock ? mockClient : httpClient;

export type ApiClient = typeof mockClient;
