import { describe, expect, it } from "vitest";
import { activateStatements, compileStatement, datasourceStatement, dqRules, TABLES } from "../src/zetaris/usl";

describe("provenance USL", () => {
  it("declares every table it activates", () => {
    const ddl = compileStatement();
    for (const t of TABLES) expect(ddl).toMatch(new RegExp(`^CREATE TABLE ${t} \\(`, "m"));
    expect(ddl.startsWith("COMPILE USL IF NOT EXISTS provenance DEPLOY NAMESPACE lightning.metastore.cartograph DDL")).toBe(true);
  });

  it("binds every activation query to the datasource and leaves no placeholder", () => {
    const stmts = activateStatements("cartograph_pg");
    expect(stmts.map((s) => s.table)).toEqual([...TABLES]);
    for (const s of stmts) {
      expect(s.sql).toMatch(/^ACTIVATE USL TABLE lightning\.metastore\.cartograph\.provenance\.\w+ AS\nSELECT/);
      expect(s.sql).toContain("cartograph_pg.");
      expect(s.sql).not.toContain("${source}");
    }
  });

  it("reads the data-quality rules", () => {
    expect(dqRules()).toEqual([
      { name: "has_review_trail", table: "code_change", expression: "pr_id IS NOT NULL" },
      { name: "states_a_reason", table: "pull_request", expression: "issue_count > 0 OR length(COALESCE(body, '')) >= 120" },
    ]);
  });

  it("points Zetaris at the store inside the Docker network", () => {
    const sql = datasourceStatement("postgres://cartograph:s3cr%40t@localhost:5433/cartograph", "cartograph-pg:5432");
    expect(sql).toContain('jdbcurl "jdbc:postgresql://cartograph-pg:5432/cartograph"');
    expect(sql).toContain('username "cartograph"');
    expect(sql).toContain('password "s3cr@t"');
  });
});
