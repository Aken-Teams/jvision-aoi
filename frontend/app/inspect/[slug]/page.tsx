import Operator from "../Operator";

export default async function InspectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let name = slug;
  try {
    name = decodeURIComponent(slug); // segment may arrive percent-encoded (e.g. 產線A)
  } catch {}
  return <Operator slug={name} />;
}
