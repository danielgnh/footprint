<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function getConnection(): ?string
    {
        return config('footprint.connection');
    }

    public function up(): void
    {
        Schema::create('footprint_visits', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('host', 100);
            $table->string('entry_path', 255);
            $table->string('referrer_host', 255)->nullable();
            $table->string('utm_source', 100)->nullable();
            $table->string('utm_medium', 100)->nullable();
            $table->string('utm_campaign', 100)->nullable();
            $table->string('utm_content', 100)->nullable();
            $table->string('device', 10);
            $table->unsignedSmallInteger('viewport');
            $table->string('lang', 20)->nullable();
            $table->unsignedInteger('views')->default(0);
            $table->unsignedInteger('events')->default(0);
            $table->timestamp('started_at');
            $table->timestamp('ended_at');

            $table->index(['host', 'started_at']);
        });

        Schema::create('footprints', function (Blueprint $table) {
            $table->id();
            $table->uuid('visit_id');
            $table->unsignedSmallInteger('view');
            $table->unsignedInteger('t');
            $table->string('host', 100);
            $table->string('path', 255);
            $table->string('type', 10);
            $table->string('section', 100)->nullable();
            $table->unsignedSmallInteger('section_index')->nullable();
            $table->string('target', 100)->nullable();
            $table->string('href', 255)->nullable();
            $table->string('previous', 255)->nullable();
            $table->string('form', 100)->nullable();
            $table->decimal('x', 5, 4)->nullable();
            $table->decimal('y', 5, 4)->nullable();
            $table->unsignedInteger('value')->nullable();
            $table->json('data')->nullable();
            $table->timestamp('created_at');

            $table->index(['host', 'path', 'type', 'created_at']);
            $table->index(['visit_id', 'view']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('footprints');
        Schema::dropIfExists('footprint_visits');
    }
};
