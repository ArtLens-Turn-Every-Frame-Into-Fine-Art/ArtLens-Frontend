import { Dimensions } from "react-native";

const { width, height } = Dimensions.get("window");

export const COLORS = {
	primary: "#7B61FF",
	primaryLight: "#A291FF",
	accent: "#FF7675",
	background: "#F8F9FB",
	white: "#FFFFFF",
	black: "#000000",
	textMain: "#1C1C1E",
	textGray: "#8E8E93",
	border: "#F2F2F7",
	cardBg: "#FBFBFF",
	success: "#4CD964",
};

export const LAYOUT = {
	window: { width, height },
	isSmallDevice: width < 375,
	padding: 20,
	borderRadius: 15,
};

export const APP_INFO = {
	name: "ArtLens",
	version: "2.4.0",
	build: "1024",
	supportEmail: "support@artlens.app",
	twitterHandle: "@ArtLensApp",
};
