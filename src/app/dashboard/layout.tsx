import { MonitorInatividade } from "@/components/MonitorInatividade";
import { NavPainel } from "@/components/painel/NavPainel";

export default function LayoutDashboard(props: LayoutProps<"/dashboard">) {
  return (
    <>
      <MonitorInatividade />
      <NavPainel />
      {props.children}
    </>
  );
}
