import { Console, Effect } from "effect"

import {
  assertValidMigrationPlan,
  loadPostgresMigrations,
  postgresMigrations,
} from "../services/postgres-migrations.js"

const program = Effect.sync(() => {
  assertValidMigrationPlan(postgresMigrations)
  return loadPostgresMigrations()
}).pipe(
  Effect.flatMap((migrations) =>
    Console.log(
      JSON.stringify(
        {
          postgres_migration_plan: "passed",
          migrations: migrations.map((migration) => ({
            migration_id: migration.migration_id,
            checksum: migration.checksum,
            bytes: migration.sql.length,
          })),
        },
        null,
        2,
      ),
    ),
  ),
)

Effect.runPromise(program)
