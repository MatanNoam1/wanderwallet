import { signIn, auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#070709",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: 360,
          maxWidth: "90%",
          borderRadius: 24,
          padding: "40px 32px",
          background: "linear-gradient(180deg,#15151e,#0f0f17)",
          border: "1px solid rgba(255,255,255,0.07)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            margin: "0 auto 18px",
            borderRadius: 14,
            background: "linear-gradient(135deg,#8b5cf6,#ec4899)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontWeight: 700,
            fontSize: 24,
          }}
        >
          W
        </div>
        <h1 style={{ color: "#f4f4f7", fontSize: 22, margin: 0 }}>Wanderwallet</h1>
        <p style={{ color: "#7a7a88", fontSize: 13, margin: "8px 0 28px" }}>
          Shared trip expense account
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            style={{
              width: "100%",
              height: 46,
              borderRadius: 12,
              border: "none",
              background: "linear-gradient(135deg,#8b5cf6,#ec4899)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14.5,
              cursor: "pointer",
            }}
          >
            Sign in with Google
          </button>
        </form>
      </div>
    </div>
  );
}
