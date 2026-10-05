<?php

namespace Database\Seeders;

use App\Models\Achievement;
use App\Models\KnowledgeNode;
use App\Models\Mission;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Imports the single source of truth content (packages/content/data) into the
 * database so the API can serve it. The content path is configurable for Docker.
 */
class ContentSeeder extends Seeder
{
    public function run(): void
    {
        $base = env('CONTENT_PATH', base_path('../../packages/content/data'));
        if (! is_dir($base)) {
            $this->command?->warn("Content path not found: {$base} — skipping content seed.");
            return;
        }

        $read = fn (string $f) => json_decode(file_get_contents("{$base}/{$f}"), true);

        // missions
        $order = 0;
        foreach (glob("{$base}/missions/act-*.json") as $file) {
            foreach (json_decode(file_get_contents($file), true) as $m) {
                Mission::updateOrCreate(['id' => $m['id']], [
                    'act' => $m['act'],
                    'slug' => $m['slug'],
                    'order' => $m['order'],
                    'title_key' => $m['slug'],
                    'content_version' => '1.0.0',
                    'definition_json' => $m,
                    'enabled' => true,
                ]);
                $order++;
            }
        }
        $this->command?->info("Seeded {$order} missions.");

        foreach ($read('knowledge.json') as $k) {
            KnowledgeNode::updateOrCreate(['id' => $k['id']], ['category' => $k['category'], 'definition_json' => $k]);
        }

        foreach ($read('achievements.json') as $a) {
            Achievement::updateOrCreate(['id' => $a['id']], ['slug' => $a['id'], 'definition_json' => $a]);
        }
    }
}
