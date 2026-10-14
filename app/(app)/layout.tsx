import { WithUserName } from "./with-user-name";

/** Every app screen's header shows the user's display name (05 §5.1); this is where it is read. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <WithUserName>{children}</WithUserName>;
}
