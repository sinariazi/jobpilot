import type { Job } from "./types";

export const demoJobs: Job[] = [
  {
    id: "demo-job-1", company: "Northstar AI", role: "Senior Full-Stack Engineer",
    location: "Vienna, Austria", mode: "Hybrid", posted: "2 days ago", source: "Demo",
    skills: ["TypeScript", "React", "Next.js", "Node.js", "PostgreSQL", "AWS", "LLM integration", "Playwright"],
    required: ["TypeScript", "React", "Node.js", "PostgreSQL", "AWS"],
    summary: "Build customer-facing workflows for an AI operations platform, from React interfaces to reliable APIs.",
  },
  {
    id: "demo-job-2", company: "Alpine Systems", role: "Technical Product Engineer",
    location: "Vienna, Austria", mode: "Hybrid", posted: "4 days ago", source: "Demo",
    skills: ["TypeScript", "React", "System design", "REST APIs", "PostgreSQL", "Docker", "AI"],
    required: ["TypeScript", "React", "REST APIs", "System design"],
    summary: "Work across product and engineering to turn customer problems into production software.",
  },
  {
    id: "demo-job-3", company: "CloudHarbor", role: "Platform Engineer",
    location: "Remote — Europe", mode: "Remote", posted: "1 week ago", source: "Demo",
    skills: ["AWS", "Kubernetes", "Docker", "CI/CD", "Kafka", "Observability", "Python"],
    required: ["AWS", "Kubernetes", "Docker", "Python", "Observability"],
    summary: "Improve developer infrastructure and distributed services across a cloud-native platform.",
  },
  {
    id: "demo-job-4", company: "BrightCart", role: "Senior Frontend Engineer",
    location: "Zurich, Switzerland", mode: "Hybrid", posted: "5 days ago", source: "Demo",
    skills: ["TypeScript", "React", "Next.js", "Playwright", "Accessibility", "GraphQL"],
    required: ["TypeScript", "React", "GraphQL", "Accessibility"],
    summary: "Own high-traffic commerce experiences and improve quality across a large frontend platform.",
  },
];
