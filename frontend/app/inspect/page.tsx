import { Aperture } from "lucide-react";

export default function InspectIndex() {
  return (
    <main className="opLogin">
      <div className="opLoginCard">
        <Aperture size={40} />
        <h1>JVision 檢測站</h1>
        <p>請使用管理員提供的檢測 App 網址，例如 /產線A。</p>
      </div>
    </main>
  );
}
