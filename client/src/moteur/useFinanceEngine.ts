// Hook React du moteur de capacité d'emprunt.
//
// Il ne fait que mémoïser `calculerFinance` : pas d'effet, pas d'appel réseau,
// pas d'état. Le résultat suit donc la saisie sans latence, dans le même rendu.
import { useMemo } from "react";
import { calculerFinance } from "./moteurFinancier.ts";
import type { BudgetInput, OptionsMoteur, ResultatFinance } from "./moteurFinancier.ts";

export type * from "./moteurFinancier.ts";

/**
 * Calcule la capacité d'emprunt du foyer à partir de ses données.
 *
 * Le calcul n'est refait que lorsque `entree` ou `options` changent d'identité :
 * les garder dans un état (ou un `useMemo`) plutôt que de les reconstruire à
 * chaque rendu, sans quoi la mémoïsation ne sert à rien.
 *
 * @example
 * const [entree, setEntree] = useState<BudgetInput>(valeursInitiales);
 * const { analyseEndettement, enveloppesAchat } = useFinanceEngine(entree);
 */
export function useFinanceEngine(entree: BudgetInput, options?: OptionsMoteur): ResultatFinance {
  return useMemo(() => calculerFinance(entree, options), [entree, options]);
}

export default useFinanceEngine;
