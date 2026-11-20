import type { ComponentType } from "react";
import { MessageSquare, Radio, Rows3, type LucideIcon } from "lucide-react";
import DevicesScreen from "@/features/devices/DevicesScreen";
import ModelsScreen from "@/features/models/ModelsScreen";
import ChatScreen from "@/features/chat/ChatScreen";
import type { Screen } from "@/lib/stores";

export type RouteId = Screen;

export interface Route {
  id: RouteId;
  label: string;
  icon: LucideIcon;
  Screen: ComponentType;
}

export const routes: Route[] = [
  { id: "devices", label: "Devices", icon: Radio, Screen: DevicesScreen },
  { id: "models", label: "Models", icon: Rows3, Screen: ModelsScreen },
  { id: "chat", label: "Chat", icon: MessageSquare, Screen: ChatScreen },
];
