import React, { createContext, useContext, useEffect, ReactNode } from "react";
import { useModelStore } from "../stores/useModelStore";

const ModelContext = createContext<
	ReturnType<typeof useModelStore> | undefined
>(undefined);

export const ModelProvider: React.FC<{ children: ReactNode }> = ({
	children,
}) => {
	const store = useModelStore();

	// Centralized fetch: happens once at app startup
	useEffect(() => {
		store.fetchModels();
	}, [store]);

	return (
		<ModelContext.Provider value={store}>{children}</ModelContext.Provider>
	);
};

export const useModels = () => {
	const context = useContext(ModelContext);
	if (!context)
		throw new Error("useModels must be used within ModelProvider");
	return context;
};
