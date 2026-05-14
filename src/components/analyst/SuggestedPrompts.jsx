import { TrendingUp, Users, Globe, MousePointer, Target, BarChart3, Link, Lightbulb } from "lucide-react";

const prompts = [
  {
    icon: TrendingUp,
    category: "Traffic",
    text: "What's driving the most traffic to our website this month? Show trends and highlight any surprises.",
  },
  {
    icon: BarChart3,
    category: "Campaigns",
    text: "Which UTM campaigns are performing best and worst? Compare sessions, bounce rate, and engagement — then suggest improvements.",
  },
  {
    icon: MousePointer,
    category: "Content",
    text: "Which pages get the most views and which have the worst drop-off? What should we prioritise?",
  },
  {
    icon: Globe,
    category: "Geo & Device",
    text: "Where are our visitors coming from by country and device? Are there markets we should invest more in?",
  },
  {
    icon: Users,
    category: "Segments",
    text: "Build me a high-value customer segment based on engagement and membership data with an estimated audience size.",
  },
  {
    icon: Link,
    category: "UTM Builder",
    text: "Create an optimised UTM link for a new paid social campaign targeting our top-performing market.",
  },
  {
    icon: Target,
    category: "SEO",
    text: "What are our top organic search keywords and how do they compare to paid traffic performance?",
  },
  {
    icon: Lightbulb,
    category: "Opportunities",
    text: "What's one growth opportunity hiding in our data that we might be overlooking? Show me the numbers.",
  },
];

export default function SuggestedPrompts({ onSelect }) {
  return (
    <div className="flex-1 overflow-auto">
    <div className="min-h-full flex flex-col items-center justify-center px-8 py-10">
      <div className="text-center mb-8">
        <h2 className="font-heading text-2xl font-semibold tracking-tight mb-2">
          What would you like to know?
        </h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Ask me anything about your traffic, campaigns, members, or growth opportunities.
          I'll query your data, generate charts, and surface insights you can act on.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl w-full">
        {prompts.map((prompt, i) => (
          <button
            key={i}
            onClick={() => onSelect(prompt.text)}
            className="flex items-start gap-3 text-left p-4 rounded-lg border border-border hover:border-foreground/20 hover:bg-secondary/50 transition-all group"
          >
            <prompt.icon className="w-4 h-4 mt-0.5 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0" />
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-0.5">{prompt.category}</p>
              <p className="text-sm">{prompt.text}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
    </div>
  );
}
