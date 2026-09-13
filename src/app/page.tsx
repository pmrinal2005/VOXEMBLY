import { redirect } from "next/navigation";

/** §10: no landing page — boot straight into the product. */
export default function Home() {
  redirect("/studio");
}
