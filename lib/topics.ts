export type TopicKey =
  | "influence_tracing"
  | "influence_tracing_continual_learning"
  | "influence_tracing_federated_learning"
  | "influence_tracing_federated_continual_learning";

export type TopicDefinition = {
  key: TopicKey;
  displayName: string;
  shortName: string;
  csvFile: string;
  description: string;
};

export const TOPICS: TopicDefinition[] = [
  {
    key: "influence_tracing",
    displayName: "Influence Tracing",
    shortName: "Influence",
    csvFile: "papers_influence_tracing.csv",
    description:
      "Influence functions, training data attribution, data valuation, Data Shapley, TracIn, TRAK, representer points, memorization, and model debugging."
  },
  {
    key: "influence_tracing_continual_learning",
    displayName: "Influence Tracing in Continual Learning",
    shortName: "Continual",
    csvFile: "papers_influence_tracing_continual_learning.csv",
    description:
      "Influence tracing and data attribution in continual learning, lifelong learning, rehearsal, exemplar selection, and catastrophic forgetting."
  },
  {
    key: "influence_tracing_federated_learning",
    displayName: "Influence Tracing in Federated Learning",
    shortName: "Federated",
    csvFile: "papers_influence_tracing_federated_learning.csv",
    description:
      "Client contribution, data valuation, influence functions, Shapley-style valuation, client selection, personalization, and federated unlearning."
  },
  {
    key: "influence_tracing_federated_continual_learning",
    displayName: "Influence Tracing in Federated Continual Learning",
    shortName: "Fed Continual",
    csvFile: "papers_influence_tracing_federated_continual_learning.csv",
    description:
      "Influence and data attribution at the intersection of federated learning, continual learning, client drift, task drift, personalization, and forgetting."
  }
];

export const DEFAULT_TOPIC: TopicKey = "influence_tracing";

export function getTopic(key: TopicKey) {
  return TOPICS.find((topic) => topic.key === key) ?? TOPICS[0];
}
