import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
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
import { useAuth } from "@/shared/auth/auth-context";
import { FormField } from "@/shared/components/form-field";
import { api } from "@/shared/api/client";
import { toastApiError } from "@/shared/lib/api-toast";
import { cn } from "@/shared/lib/cn";

export function SetupPage() {
  const navigate = useNavigate();
  const { refresh, user } = useAuth();
  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [ready, setReady] = useState(true);

  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [siteName, setSiteName] = useState("CardKey");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const st = await api.setupStatus();
        if (cancelled) return;
        setNeedsSetup(st.needsSetup);
        setReady(st.ready);
        if (st.siteName) setSiteName(st.siteName);
      } catch {
        if (!cancelled) setReady(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (checking) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        检查安装状态…
      </div>
    );
  }

  if (!needsSetup) {
    if (user) return <Navigate to="/admin" replace />;
    return <Navigate to="/admin/login" replace />;
  }

  function validateStep0() {
    const e: Record<string, string> = {};
    if (username.trim().length < 2) e.username = "至少 2 个字符";
    if (password.length < 8) e.password = "至少 8 位";
    if (password !== confirm) e.confirm = "两次密码不一致";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit() {
    if (!validateStep0()) {
      setStep(0);
      return;
    }
    setLoading(true);
    try {
      await api.completeSetup({
        username: username.trim(),
        password,
        confirmPassword: confirm,
        siteName: siteName.trim() || "CardKey",
      });
      toast.success("安装完成，欢迎使用 CardKey");
      await refresh();
      navigate("/admin", { replace: true });
    } catch (err) {
      toastApiError(err, "安装失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md border-border/60 shadow-sm">
        <CardHeader className="text-center space-y-1">
          <CardTitle className="text-lg">CardKey 首次安装</CardTitle>
          <CardDescription className="text-xs">
            创建管理员账号后即可使用管理后台
          </CardDescription>
          {!ready ? (
            <p className="text-xs text-destructive">
              依赖服务未就绪，请确认数据库与 Redis 已启动
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 text-[11px] text-muted-foreground">
            {["管理员", "站点选项", "完成"].map((label, i) => (
              <div
                key={label}
                className={cn(
                  "flex-1 rounded-full py-1 text-center",
                  step === i
                    ? "bg-primary text-primary-foreground"
                    : step > i
                      ? "bg-secondary text-foreground"
                      : "bg-secondary/50",
                )}
              >
                {label}
              </div>
            ))}
          </div>

          {step === 0 ? (
            <div className="space-y-3">
              <FormField label="管理员用户名" required error={errors.username}>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="admin"
                />
              </FormField>
              <FormField label="密码" required error={errors.password}>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="至少 8 位"
                />
              </FormField>
              <FormField label="确认密码" required error={errors.confirm}>
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </FormField>
              <Button
                className="w-full"
                type="button"
                onClick={() => {
                  if (validateStep0()) setStep(1);
                }}
              >
                下一步
              </Button>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-3">
              <FormField label="站点名称">
                <Input
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="CardKey"
                />
              </FormField>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStep(0)}
                >
                  上一步
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  onClick={() => setStep(2)}
                >
                  下一步
                </Button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border bg-secondary/40 p-3 text-xs space-y-1.5">
                <p>
                  <span className="text-muted-foreground">管理员</span>{" "}
                  <span className="font-medium">{username}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">站点</span>{" "}
                  {siteName || "CardKey"}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                完成后将自动登录并进入仪表盘。不会写入任何示例类别或卡密；请在后台自行创建。数据库与 Redis
                端口/密码在部署时的 .env 中配置。
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStep(1)}
                  disabled={loading}
                >
                  上一步
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  loading={loading}
                  disabled={!ready}
                  onClick={() => void submit()}
                >
                  {loading ? "创建中…" : "完成安装"}
                </Button>
              </div>
            </div>
          ) : null}

          <p className="text-center text-[11px] text-muted-foreground">
            已有账号？{" "}
            <Link
              to="/admin/login"
              className="underline-offset-2 hover:underline"
            >
              去登录
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
