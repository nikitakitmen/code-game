<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('game_profiles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->unique()->constrained()->nullOnDelete();
            $table->uuid('guest_uuid')->nullable()->unique();
            $table->string('guest_token', 80)->nullable()->unique();
            $table->string('company_name')->nullable();
            $table->string('current_mission_id')->nullable();
            $table->json('campaign_state_json')->nullable();
            $table->json('knowledge_state_json')->nullable();
            $table->json('settings_json')->nullable();
            $table->timestamps();
        });

        Schema::create('game_saves', function (Blueprint $table) {
            $table->id();
            $table->foreignId('profile_id')->constrained('game_profiles')->cascadeOnDelete();
            $table->unsignedInteger('schema_version');
            $table->unsignedBigInteger('revision')->default(0);
            $table->longText('state_json');
            $table->unsignedBigInteger('simulation_seed');
            $table->string('checkpoint_type')->default('autosave'); // main | mission-start | manual | pre-restore | auto
            $table->string('label')->nullable();
            $table->string('mission_id')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->index(['profile_id', 'checkpoint_type']);
        });

        Schema::create('missions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->unsignedSmallInteger('act');
            $table->string('slug');
            $table->unsignedSmallInteger('order')->index();
            $table->string('title_key')->nullable();
            $table->string('content_version');
            $table->json('definition_json');
            $table->boolean('enabled')->default(true);
            $table->timestamps();
        });

        Schema::create('mission_attempts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('profile_id')->constrained('game_profiles')->cascadeOnDelete();
            $table->string('mission_id');
            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->string('result')->nullable(); // success | abandoned
            $table->string('selected_hypothesis')->nullable();
            $table->json('decision_log_json')->nullable();
            $table->json('metrics_before_json')->nullable();
            $table->json('metrics_after_json')->nullable();
            $table->index(['profile_id', 'mission_id']);
        });

        Schema::create('knowledge_nodes', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('category');
            $table->json('definition_json');
        });

        Schema::create('knowledge_progress', function (Blueprint $table) {
            $table->id();
            $table->foreignId('profile_id')->constrained('game_profiles')->cascadeOnDelete();
            $table->string('knowledge_node_id');
            $table->string('state')->default('locked');
            $table->unsignedInteger('score')->default(0);
            $table->timestamp('last_practiced_at')->nullable();
            $table->unique(['profile_id', 'knowledge_node_id']);
        });

        Schema::create('achievements', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('slug');
            $table->json('definition_json');
        });

        Schema::create('achievement_unlocks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('profile_id')->constrained('game_profiles')->cascadeOnDelete();
            $table->string('achievement_id');
            $table->timestamp('unlocked_at')->nullable();
            $table->unique(['profile_id', 'achievement_id']);
        });
    }

    public function down(): void
    {
        foreach (['achievement_unlocks','achievements','knowledge_progress','knowledge_nodes','mission_attempts','missions','game_saves','game_profiles'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
