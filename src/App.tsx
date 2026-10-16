function SectionHeading({
  title,
  subtitle,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        ...styles.sectionHeadingContainer,
        marginBottom: compact ? "12px" : "20px",
      }}
    >
      <div
        style={{
          ...styles.sectionHeadingAccent,
          height: compact ? "27px" : "34px",
        }}
      />

      <div>
        <h2
          style={{
            ...styles.sectionHeading,
            fontSize: compact ? "18px" : "22px",
          }}
        >
          {title}
        </h2>

        {subtitle && (
          <p
            style={{
              ...styles.sectionSubtitle,
              margin: compact ? "3px 0 0" : "5px 0 0",
              fontSize: compact ? "12px" : "14px",
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
