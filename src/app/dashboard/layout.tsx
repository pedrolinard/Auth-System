import { MonitorInatividade } from "@/components/MonitorInatividade";

export default function LayoutDashboard(props: LayoutProps<"/dashboard">) {
  return (
    <>
      <MonitorInatividade />
      {props.children}
    </>
  );
}
