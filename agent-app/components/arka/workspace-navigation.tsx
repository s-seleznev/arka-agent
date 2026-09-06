"use client";
import styles from "./workspace.module.css";
import { Home, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WorkspaceNavigation({ isArka, onSelect }: { isArka: boolean; onSelect: (overview: boolean) => void }) {
  return (<div className={styles.header}><div className={styles.brand}><div className="menu-btn"><svg width="24" height="24"><use href="/arka/icons.svg#menu" /></svg></div><svg className="brand-svg" viewBox="0 0 72 24" fill="none"><path d="M13.5061 21L12.0418 16.1345H5.17521L3.71101 21H0L5.73061 3H11.5622L17.318 21H13.5061ZM8.0279 6.60505L6.13454 12.8571H11.032L9.13867 6.60505H8.0279Z" fill="#333C4E"></path><path d="M19.5137 3H27.7436C29.8136 3 31.4125 3.5042 32.5401 4.51261C33.6845 5.52101 34.2567 6.92438 34.2567 8.72268C34.2567 10.5546 33.6845 11.9832 32.5401 13.0084C31.4125 14.0336 29.8136 14.5462 27.7436 14.5462H23.2752V21H19.5137V3ZM23.2752 11.2437H27.2134C28.341 11.2437 29.1488 11.042 29.6369 10.6386C30.1418 10.2185 30.3943 9.59665 30.3943 8.77312C30.3943 7.94958 30.1418 7.33613 29.6369 6.93276C29.1488 6.5126 28.341 6.30252 27.2134 6.30252H23.2752V11.2437Z" fill="#333C4E"></path><path d="M37.4219 21V3H41.1832V10.0336H45.4499L48.7567 3H52.6447L48.6054 11.7479L52.8718 21H48.9841L45.4751 13.437H41.1832V21H37.4219Z" fill="#333C4E"></path><path d="M68.3969 21L66.9326 16.1345H60.066L58.6017 21H54.8906L60.6212 3H66.4529L72.2087 21H68.3969ZM62.9186 6.60505L61.0252 12.8571H65.9225L64.0294 6.60505H62.9186Z" fill="#333C4E"></path></svg></div><nav className={styles.switcher} data-assistant={!isArka} aria-label="Раздел рабочего пространства">
    <span className={styles.switchIndicator} aria-hidden="true" />
    <Button type="button" variant="ghost" onClick={() => onSelect(true)} aria-label="Обзор" aria-pressed={isArka}><Home strokeWidth={1.5} /><span className={styles.switchLabel}>Обзор</span></Button>
    <Button type="button" variant="ghost" onClick={() => onSelect(false)} aria-label="Ассистент" aria-pressed={!isArka}><MessageCircle strokeWidth={1.5} /><span className={styles.switchLabel}>Ассистент</span></Button>
  </nav></div>);
}
