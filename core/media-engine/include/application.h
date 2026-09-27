#pragma once

class MeApplication {
public:
  MeApplication();
  ~MeApplication();

  MeApplication(const MeApplication&) = delete;
  MeApplication& operator=(const MeApplication&) = delete;

  bool Initialize(int argc, char** argv);
};