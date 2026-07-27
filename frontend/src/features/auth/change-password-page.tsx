import { useState } from "react";
import { useNavigate } from "react-router-dom";
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

export function ChangePasswordPage() {
  const { refresh, user } = useAuth();
  const navigate = useNavigate();
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (newPassword.length < 8) next.newPassword = "至少 8 位";
    if (newPassword !== confirm) next.confirm = "两次输入不一致";
    if (!oldPassword) next.oldPassword = "请输入原密码";
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      toast.success("密码已更新");
      await refresh();
      navigate("/admin", { replace: true });
    } catch (err) {
      toastApiError(err, "修改失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm border-border/60">
        <CardHeader className="text-center">
          <CardTitle className="text-base">修改密码</CardTitle>
          <CardDescription>
            {user?.mustChangePassword
              ? "首次登录须修改初始密码后方可使用后台"
              : `账号 ${user?.username ?? ""}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3.5" onSubmit={(e) => void onSubmit(e)}>
            <FormField label="原密码" required error={errors.oldPassword}>
              <Input
                type="password"
                autoComplete="current-password"
                value={oldPassword}
                onChange={(e) => setOld(e.target.value)}
                disabled={loading}
              />
            </FormField>
            <FormField label="新密码" required error={errors.newPassword}>
              <Input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNew(e.target.value)}
                disabled={loading}
                placeholder="至少 8 位"
              />
            </FormField>
            <FormField label="确认新密码" required error={errors.confirm}>
              <Input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={loading}
              />
            </FormField>
            <Button className="w-full" type="submit" loading={loading}>
              {loading ? "提交中…" : "确认修改"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
