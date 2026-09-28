#pragma once

#include <memory>

class MeApplicationPrivate;

class MeApplication {
  std::unique_ptr<MeApplicationPrivate> d_ptr;

public:
  MeApplication(int argc, char** argv);
  ~MeApplication();

  MeApplication(const MeApplication&) = delete;
  MeApplication& operator=(const MeApplication&) = delete;

  static MeApplication* Instance() {
    return MeApplication::s_instance;
  }

  bool Exec();

private:
  static MeApplication* s_instance;
};

#define meApp MeApplication::Instance()