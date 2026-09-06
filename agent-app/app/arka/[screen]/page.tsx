import Screen0 from "@/components/arka/screens/calendar";
import Screen1 from "@/components/arka/screens/commands";
import Screen2 from "@/components/arka/screens/list-bulls";
import Screen3 from "@/components/arka/screens/list-culling";
import Screen4 from "@/components/arka/screens/list-dry";
import Screen5 from "@/components/arka/screens/list-fresh";
import Screen6 from "@/components/arka/screens/list-heifers";
import Screen7 from "@/components/arka/screens/list-insem";
import Screen8 from "@/components/arka/screens/list-inseminated";
import Screen9 from "@/components/arka/screens/list-lame";
import Screen10 from "@/components/arka/screens/list-sick";
import Screen11 from "@/components/arka/screens/list-work";
import Screen12 from "@/components/arka/screens/list";
import { notFound } from "next/navigation";
const screens = {
  "calendar": Screen0,
  "commands": Screen1,
  "list-bulls": Screen2,
  "list-culling": Screen3,
  "list-dry": Screen4,
  "list-fresh": Screen5,
  "list-heifers": Screen6,
  "list-insem": Screen7,
  "list-inseminated": Screen8,
  "list-lame": Screen9,
  "list-sick": Screen10,
  "list-work": Screen11,
  "list": Screen12
};
export default async function Page({params}: {params: Promise<{screen:string}>}) {
const {screen}=await params;
if (!Object.hasOwn(screens,screen)) notFound();
const Screen=screens[screen as keyof typeof screens];
return <Screen />;
}
