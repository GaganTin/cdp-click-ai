import { TrendingUp, Users, Globe, MousePointer, Target, BarChart3, Link, Lightbulb, PieChart, Activity } from "lucide-react";

const PROMPT_SETS = [
  // Set 0 - Traffic & growth
  [
    { icon: TrendingUp, category: "Traffic", text: "What's driving the most traffic to our website this month? Show trends and highlight any surprises." },
    { icon: BarChart3, category: "Campaigns", text: "Which UTM campaigns are performing best and worst? Compare sessions, bounce rate, and engagement - then suggest improvements." },
    { icon: MousePointer, category: "Content", text: "Which pages get the most views and which have the worst drop-off? What should we prioritise?" },
    { icon: Globe, category: "Geo & Device", text: "Where are our visitors coming from by country and device? Are there markets we should invest more in?" },
    { icon: Users, category: "Segments", text: "Build me a high-value customer segment based on engagement and membership data with an estimated audience size." },
    { icon: Link, category: "UTM Builder", text: "Create an optimised UTM link for a new paid social campaign targeting our top-performing market." },
    { icon: Target, category: "SEO", text: "What are our top organic search keywords and how do they compare to paid traffic performance?" },
    { icon: Lightbulb, category: "Opportunities", text: "What's one growth opportunity hiding in our data that we might be overlooking? Show me the numbers." },
  ],
  // Set 1 - Members & audience
  [
    { icon: Users, category: "Member Analysis", text: "Break down our member base by type and activity level. Who are our most engaged members?" },
    { icon: PieChart, category: "Demographics", text: "What does our membership look like by age group, education, and employment status? Any patterns we should act on?" },
    { icon: Activity, category: "Churn Risk", text: "Which members are at highest risk of lapsing? Build me a segment and suggest how to retain them." },
    { icon: TrendingUp, category: "Member Growth", text: "How has our member count grown over the last 6 months? What's driving new joins?" },
    { icon: Target, category: "High-Value Segment", text: "Who are our top 10% most engaged members? Build a segment and tell me what makes them different." },
    { icon: Users, category: "Seminar Attendees", text: "How many unique members have attended seminars? How does seminar attendance correlate with membership renewals?" },
    { icon: Globe, category: "New Joiners", text: "Analyse our new member cohort from the last 3 months - where are they coming from and what are they doing?" },
    { icon: Lightbulb, category: "Retention Tip", text: "What's the single biggest retention opportunity in our membership data right now?" },
  ],
  // Set 2 - UTM & campaign performance
  [
    { icon: BarChart3, category: "UTM Overview", text: "Give me a full breakdown of UTM campaign performance this month - which sources and mediums are winning?" },
    { icon: Link, category: "UTM Builder", text: "I'm launching a new LinkedIn campaign. Create a UTM link with proper tracking and suggest the best campaign name structure." },
    { icon: TrendingUp, category: "Top Channels", text: "Which acquisition channel (organic, paid, email, social, referral) is bringing in the most engaged visitors?" },
    { icon: MousePointer, category: "Paid vs Organic", text: "Compare paid traffic vs organic traffic quality - sessions, time on site, bounce rate, and conversion signals." },
    { icon: Target, category: "Underperforming", text: "Which UTM campaigns are underperforming? Find the lowest ROI efforts and suggest what to cut or change." },
    { icon: Globe, category: "Source Gaps", text: "Are there traffic sources or markets we're not tracking properly? Find UTM gaps in my data." },
    { icon: Activity, category: "Campaign ROI", text: "Which campaigns are driving the most member sign-ups? Show me cost-per-acquisition by source if possible." },
    { icon: Lightbulb, category: "Quick Win", text: "Based on my UTM data, what's one quick win I could implement this week to increase conversions?" },
  ],
];

export default function SuggestedPrompts({ onSelect }) {
  const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const prompts = PROMPT_SETS[dayOfYear % PROMPT_SETS.length];

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="min-h-full flex flex-col items-center justify-center px-8 py-8">
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
