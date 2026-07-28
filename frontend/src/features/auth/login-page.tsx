import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/entities/types";
import { api } from "@/shared/api/client";
import { useAuth } from "@/shared/auth/auth-context";
import { FormField } from "@/shared/components/form-field";
import { env } from "@/shared/config/env";
import { fieldErrors, loginSchema } from "@/shared/lib/schemas";

export function LoginPage() {
  const { user, loading, login, completeTotpLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname ?? "/admin";

  const [username, setUsername] = useState(env.isMock ? "admin" : "");
  const [password, setPassword] = useState(env.isMock ? "admin123" : "");
  const [totpCode, setTotpCode] = useState("");
  const [totpTicket, setTotpTicket] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    if (env.isMock) {
      setNeedsSetup(false);
      return;
    }
    void api
      .setupStatus()
      .then((s) => setNeedsSetup(s.needsSetup))
      .catch(() => setNeedsSetup(false));
  }, []);

  if (needsSetup === true) {
    return <Navigate to="/admin/setup" replace />;
  }

  if (!loading && user) {
    return <Navigate to={from} replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (totpTicket) {
      if (totpCode.trim().length !== 6) {
        toast.error("请输入 6 位验证码");
        return;
      }
      setSubmitting(true);
      try {
        await completeTotpLogin(totpTicket, totpCode.trim());
        toast.success("登录成功");
        navigate(from, { replace: true });
      } catch (err) {
        if (err instanceof ApiError) toast.error(err.message);
        else toast.error("验证失败");
      } finally {
        setSubmitting(false);
      }
      return;
    }
    const parsed = fieldErrors(loginSchema, { username, password });
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const step = await login(parsed.data.username, parsed.data.password);
      if (step?.requiresTotp && step.ticket) {
        setTotpTicket(step.ticket);
        toast.message("请输入两步验证码");
        return;
      }
      toast.success("登录成功");
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error("登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm border-border/60">
        <CardHeader className="text-center">
          <CardTitle className="text-base">管理端登录</CardTitle>
          <CardDescription>CardKey 控制台</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3.5" onSubmit={(e) => void onSubmit(e)}>
            {!totpTicket ? (
              <>
                <FormField
                  label="用户名"
                  required
                  htmlFor="username"
                  error={errors.username}
                >
                  <Input
                    id="username"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={submitting}
                  />
                </FormField>
                <FormField
                  label="密码"
                  required
                  htmlFor="password"
                  error={errors.password}
                >
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                  />
                </FormField>
              </>
            ) : (
              <FormField label="两步验证码" required htmlFor="totp">
                <Input
                  id="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6 位数字"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  disabled={submitting}
                />
              </FormField>
            )}
            <Button className="w-full" type="submit" loading={submitting}>
              {submitting
                ? "请稍候…"
                : totpTicket
                  ? "验证并登录"
                  : "登录"}
            </Button>
            {totpTicket ? (
              <button
                type="button"
                className="w-full text-center text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => {
                  setTotpTicket(null);
                  setTotpCode("");
                }}
              >
                返回账号密码
              </button>
            ) : null}
          </form>
          {env.isMock ? (
            <p className="mt-4 text-center text-[11px] text-muted-foreground">
              演示账号 admin / admin123
            </p>
          ) : (
            <p className="mt-4 text-center text-[11px] text-muted-foreground">
              首次部署？{" "}
              <Link
                to="/admin/setup"
                className="underline-offset-2 hover:underline"
              >
                打开安装向导
              </Link>
            </p>
          )}
          <p className="mt-3 text-center text-[11px]">
            <Link
              to="/"
              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              返回兑换页
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
