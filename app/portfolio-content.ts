// Keep résumé copy here so that roles, results, and technologies are easy to update.
// Employment and independent/founding roles intentionally have separate sections.
export const contact = {
  name: "Okan Can Özbek",
  email: "o.ozbek@pixelware.nl",
  phone: "+31 6 14412521",
  phoneHref: "tel:+31614412521",
  linkedin: "https://linkedin.com/in/oo-dev",
  github: "https://github.com/okan-ozbek",
  radish: "https://github.com/okan-ozbek/radish",
};

export const navigation = [
  { label: "Expertise", href: "#expertise" },
  { label: "Projects", href: "#work" },
  { label: "Experience", href: "#experience" },
  { label: "Leadership", href: "#entrepreneurship" },
  { label: "Stack", href: "#skills" },
];

export const proofPoints = [
  { value: "5+", label: "Years in production", context: "Backend & systems engineering" },
  { value: "200M+", label: "Monthly active users", context: "Scale of the platform I support at WBD" },
  { value: "7–10 ms", label: "Cached search queries", context: "Down from approximately 400 ms" },
  { value: "≈40%", label: "Fewer upstream requests", context: "Redis-backed search caching at WBD" },
];

export const expertise = [
  {
    title: "Distributed systems",
    copy: "Services that work together predictably. Clear API contracts, event-driven workflows, and replay-safe processing under concurrent load.",
    detail: "Event-driven architecture · API design",
  },
  {
    title: "Reliability & performance",
    copy: "Make the critical path faster and the failure modes visible. Caching, bounded retries, profiling, and observability built into production delivery.",
    detail: "Caching · Concurrency · Observability",
  },
  {
    title: "Systems programming",
    copy: "Work close to the machine. C++23 and Linux tooling with attention to memory locality, synchronization, persistence, and protocol correctness.",
    detail: "C++23 · Linux · Network protocols",
  },
];

export const projectOutcomes = [
  {
    company: "Warner Bros. Discovery",
    title: "A faster search hot path",
    result: "400 → 7–10 ms",
    resultLabel: "Query latency",
    copy: "Led Redis-backed caching for a production search service, with explicit TTL and invalidation rules. Upstream requests fell by approximately 40%.",
    stack: ["Redis", "Node.js", "TypeScript"],
  },
  {
    company: "FANSTR",
    title: "Integrations that recover",
    result: "25–30%",
    resultLabel: "Fewer failed external transactions",
    copy: "Made customer-critical integrations more reliable through deterministic idempotency, deduplication, and bounded retries under concurrent load.",
    stack: ["Node.js", "PostgreSQL", "RabbitMQ"],
  },
  {
    company: "Bleacher Report · WBD",
    title: "From architecture to rollout",
    result: "End to end",
    resultLabel: "Sitemap generation delivery",
    copy: "Led sitemap architecture and cross-team delivery, turning product and SEO requirements into backend responsibilities and a coordinated production rollout.",
    stack: ["Architecture", "Backend delivery", "SEO"],
  },
];

export const experience = [
  {
    years: "Mar 2026 — Present",
    role: "Software Engineer",
    company: "Warner Bros. Discovery",
    location: "Amsterdam",
    current: true,
    summary: "Building and operating Node.js and TypeScript microservices for a platform serving 200M+ monthly active users.",
    contributions: [
      "Led Bleacher Report sitemap architecture, cross-team alignment, and production rollout.",
      "Delivered search caching, replay-safe Kafka consumers, and shared Datadog instrumentation across Kafka, Redis, and Node.js.",
    ],
    stack: "Node.js · TypeScript · Kafka · Redis · AWS",
  },
  {
    years: "Aug 2024 — Aug 2025",
    role: "Senior Software Engineer",
    company: "FANSTR",
    location: "Rijswijk",
    current: false,
    summary: "Owned reliability and performance improvements across backend services and customer-critical integrations.",
    contributions: [
      "Reduced failed external transactions by approximately 25–30% with idempotency, deduplication, and controlled retries.",
      "Improved performance by approximately 40% and built RabbitMQ email and SMS pipelines with independent retries and failure isolation.",
    ],
    stack: "TypeScript · Node.js · RabbitMQ · PostgreSQL",
  },
  {
    years: "Mar 2023 — Aug 2024",
    role: "Software Engineer",
    company: "TJIP The Platform Engineer",
    location: "Delft",
    current: false,
    summary: "Architected reusable event-sourced workflows in Go, enabling auditable state transitions and adoption across teams.",
    contributions: [
      "Refactored legacy PHP into modular, testable services and strengthened delivery with automated tests, quality gates, and deployment checks.",
    ],
    stack: "Go · TypeScript · PHP · MySQL · Azure DevOps",
  },
  {
    years: "Apr 2021 — Mar 2023",
    role: "Software Engineer",
    company: "Alflex Technologies",
    location: "Zoetermeer",
    current: false,
    summary: "Connected firmware and backend systems through an in-house TCP/IP protocol in PHP and C.",
    contributions: [
      "Built binary parsing and validation, then improved relational data access with MSSQL indexing, transactions, and query optimization.",
    ],
    stack: "PHP · C · MSSQL · MySQL · TCP/IP",
  },
];

export const leadership = [
  {
    company: "Pixelware",
    type: "Independent practice",
    years: "Jun 2024 — Present",
    role: "Senior Software Engineer",
    location: "Freelance · Rotterdam",
    summary: "Taking ownership of backend architecture and delivery for concurrent, multi-tenant systems.",
    contributions: [
      "Tenant isolation, deterministic state transitions, idempotency, and row-level database locking.",
      "Performance-focused C++23 and Linux tooling: parsers, serializers, and synchronization prototypes.",
    ],
  },
  {
    company: "Cyber Dev",
    type: "Founding role",
    years: "May 2025 — Feb 2026",
    role: "Founding Software Engineer",
    location: "Engineering & technical leadership",
    summary: "Shaped technical strategy, security architecture, and delivery for a client-facing cybersecurity platform.",
    contributions: [
      "Established secure coding, testing, review, observability, and release standards.",
      "Led and mentored engineers and interns, with clear ownership and security-sensitive reviews.",
    ],
  },
];

export const stackGroups = [
  {
    title: "Languages & runtimes",
    description: "Application services to low-level systems.",
    tools: [
      { name: "TypeScript", icon: "typescript" },
      { name: "Node.js", icon: "nodejs" },
      { name: "C++17 / 20 / 23", icon: "cplusplus" },
      { name: "Go", icon: "go" },
      { name: "Java", icon: "java" },
      { name: "PHP", icon: "php" },
      { name: "C", icon: "c" },
      { name: "CMake", icon: "cmake" },
    ],
    detail: "Memory locality · Synchronization · Protocol design",
  },
  {
    title: "Messaging & APIs",
    description: "Contracts, coordination, and reliable delivery.",
    tools: [
      { name: "Kafka", icon: "apachekafka" },
      { name: "RabbitMQ", icon: "rabbitmq" },
      { name: "Redis", icon: "redis" },
      { name: "gRPC", icon: "grpc" },
      { name: "GraphQL Federation", icon: "graphql" },
    ],
    detail: "REST APIs · Event sourcing · Idempotency · Caching",
  },
  {
    title: "Cloud & operations",
    description: "Shipping, observing, and running production.",
    tools: [
      { name: "AWS", icon: "amazonwebservices" },
      { name: "Docker", icon: "docker" },
      { name: "Linux", icon: "linux" },
      { name: "Azure DevOps", icon: "azuredevops" },
      { name: "Datadog", icon: "datadog" },
      { name: "Grafana", icon: "grafana" },
    ],
    detail: "ECS · S3 · DynamoDB · ElastiCache · CI/CD",
  },
  {
    title: "Databases & storage",
    description: "Data models, queries, and durable state.",
    tools: [
      { name: "PostgreSQL", icon: "postgresql" },
      { name: "MySQL", icon: "mysql" },
      { name: "MariaDB", icon: "mariadb" },
      { name: "Microsoft SQL Server", icon: "microsoftsqlserver" },
      { name: "MongoDB", icon: "mongodb" },
    ],
    detail: "SQL · Indexing · Transactions · Row-level locking",
  },
];
