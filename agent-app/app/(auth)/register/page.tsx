"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActionState, useEffect, useState } from "react";
import { AuthForm } from "@/components/chat/auth-form";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";
import { type RegisterActionState, register } from "../actions";

export default function Page() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSuccessful, setIsSuccessful] = useState(false);

  const [state, formAction] = useActionState<RegisterActionState, FormData>(
    register,
    { status: "idle" }
  );

  const { update: updateSession } = useSession();

  // biome-ignore lint/correctness/useExhaustiveDependencies: router and updateSession are stable refs
  useEffect(() => {
    if (state.status === "user_exists") {
      toast({ description: "Аккаунт уже существует", type: "error" });
    } else if (state.status === "failed") {
      toast({ description: "Не удалось создать аккаунт", type: "error" });
    } else if (state.status === "invalid_data") {
      toast({
        description: "Проверьте введённые данные",
        type: "error",
      });
    } else if (state.status === "success") {
      toast({ description: "Аккаунт создан", type: "success" });
      setIsSuccessful(true);
      updateSession();
      router.refresh();
    }
  }, [state.status]);

  const handleSubmit = (formData: FormData) => {
    setEmail(formData.get("email") as string);
    formAction(formData);
  };

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Новый аккаунт</h1>
      <p className="text-sm text-muted-foreground">Создайте аккаунт Аркаши</p>
      <AuthForm action={handleSubmit} defaultEmail={email}>
        <SubmitButton isSuccessful={isSuccessful}>Создать</SubmitButton>
        <p className="text-center text-[13px] text-muted-foreground">
          {"Уже есть аккаунт? "}
          <Link
            className="text-foreground underline-offset-4 hover:underline"
            href="/login"
          >
            Войти
          </Link>
        </p>
      </AuthForm>
    </>
  );
}
